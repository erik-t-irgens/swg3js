// The paint file (Map-maker II, DESIGN.md §2.5, W2, `paintFile.ts`) and the endpoint's batch over it:
//
//   - run lengths: a family tile's and a colour tile's cells written and read back byte for byte, their runs summing to
//     the (512 / cell)² cells a tile has (16,384 at the owner's 4 m, 4,096 at 8 m), a run past a tile, short of it, past a
//     byte, of a colour of no amount, or a tile of nothing refused in words;
//   - the reader: the header held (version, world, frame, cell, tile), a file of 8 m cells read and laid as 8 m cells,
//     a bad row, a second row under one id, a row past the backstop and a family cell naming an entry the palette has not
//     got skipped and named, the flora's rows read (the fourth wave's, its own suite floraPaint.test.ts, and the recipes and flora tiles below), a space zone keeping none;
//   - the palette keyed by pack and name (a name two worlds share never collides) and the alternate it forces;
//   - the world row's every field read and refused in words, the wash among them, a field this build does not read kept
//     beside it and written back;
//   - `PAINT_LIMITS` as the backstops the reader holds;
//   - the writer: sorted, one line a row, its fields in one order, read back to the same rows; the cell taken from the
//     tiles; the batch over the paint file: a palette and a tile put in one write, a tile of nothing refused, a write that
//     would leave a cell naming an entry past the palette refused, a space zone's refused, `was` refusing a row changed
//     since, and the file gone with its last row; a flora tile naming a recipe past the recipes row refused (and a
//     recipes row cut back under one), the row and the tile taken together.
//
// Run: node tools/swg/tests/paintFile.test.ts
import assert from 'node:assert/strict';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { cellsOfTile, colourCells, colourRle, copyRecipes, familyCells, familyRle, floraCells, floraRle, isPaintId, PAINT_LIMITS, paintFileText, paintOfRead, PaintRows, paintTileId, paintTileOfId, paintWithExtras, readFloraRecipe, readPaintEntry, readPaintFile, readPaintRow, samePaintRow, tileCells, type PaintRow, type PaintTileRow } from '../../../src/world/editFiles/paintFile.ts';
import { PAINT_PALETTE_MOST, paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'tatooine';
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const sum = (rle: string) => rle.split(',').reduce((s, t) => s + (t.includes('*') ? Number(t.slice(t.indexOf('*') + 1)) : 1), 0);

// ---------------------------------------------------------------- run lengths

{
  ok(cellsOfTile(4) === 16384 && cellsOfTile(8) === 4096 && cellsOfTile(16) === 1024, 'a tile of 512 m holds 16,384 cells at 4 m, 4,096 at 8 m and 1,024 at 16 m');
  const fam = new Uint8Array(16384);
  for (let i = 0; i < fam.length; i++) fam[i] = (i % 128 < 40 && i >> 7 > 20 && i >> 7 < 60) ? 3 : i % 997 === 5 ? 200 : 0;
  const rle = familyRle(fam);
  ok(sum(rle) === 16384 && sameBytes(familyCells(rle, 16384) as Uint8Array, fam), `a family tile's runs sum to 16,384 and read back byte for byte (${rle.length} characters)`);
  const col = new Uint8Array(16384 * 4);
  for (let i = 0; i < 16384; i++) if (i % 7 === 0) col.set([i & 255, (i >> 8) & 255, 77, 1 + (i % 255)], i * 4);
  const crle = colourRle(col);
  ok(sum(crle) === 16384 && sameBytes(colourCells(crle, 16384) as Uint8Array, col), `a colour tile's runs sum to 16,384 and read back byte for byte (${crle.length} characters)`);
  const eight = new Uint8Array(4096).fill(0);
  eight[100] = 1;
  ok(sum(familyRle(eight)) === 4096 && sameBytes(familyCells(familyRle(eight), 4096) as Uint8Array, eight), 'and a tile of 8 m cells sums to 4,096');
  ok(typeof familyCells('1*16385', 16384) === 'string' && typeof familyCells('1*16383', 16384) === 'string' && typeof familyCells('256*16384', 16384) === 'string' && typeof familyCells('0*16384', 16384) === 'string', 'runs past a tile, short of it, past a byte, or a tile of nothing are refused in words');
  ok(typeof colourCells('ff000000*16384', 16384) === 'string' && typeof colourCells('0*16384', 16384) === 'string' && typeof colourCells('ff0000*16384', 16384) === 'string', 'a painted colour of no amount, a colour tile of nothing and a colour not eight hex are refused');
}

// ---------------------------------------------------------------- ids, rows

{
  // Moved on purpose by Map-maker II's fourth wave: the flora's tiles and the recipes row are rows this build writes now.
  ok(isPaintId('world') && isPaintId('palette') && isPaintId('recipes') && isPaintId('fam:3,-2') && isPaintId('col:-15,0') && isPaintId('flo:1,1') && !isPaintId('fam:3') && !isPaintId('x-1'), 'a paint row is world, palette, recipes or a tile of a layer by its place');
  ok(paintTileId('fam', 3, -2) === 'fam:3,-2' && JSON.stringify(paintTileOfId('col:-4,7')) === '{"layer":"col","tx":-4,"tz":7}', 'a tile row\'s id names its layer and place, and reads back');
  const flo = readPaintRow({ id: 'flo:1,1', rle: '0*16384' });
  const rec = readPaintRow({ id: 'recipes', list: [] });
  ok(typeof flo === 'string' && /nothing is no tile/.test(flo) && typeof rec === 'string' && /entries are a list/.test(rec), "a flora tile of nothing and a recipes row with no list are refused in words (the fourth wave reads both)");
  const pal = readPaintRow({ id: 'palette', entries: [{ pack: 'tatooine', name: 'sand_dune' }, { pack: 'naboo', name: 'sand_dune', child: 2 }] });
  ok(typeof pal === 'object' && (pal as { entries: unknown[] }).entries.length === 2, 'the palette keys a family by its pack and its name: two worlds\' families of one name are two entries');
  ok(typeof readPaintRow({ id: 'palette', entries: [{ pack: 'Tatooine', name: 'x' }] }) === 'string' && typeof readPaintRow({ id: 'palette', entries: [{ pack: 'tatooine', name: 'x', child: 300 }] }) === 'string' && typeof readPaintRow({ id: 'palette', entries: [{ pack: 'tatooine', name: 'x', glow: 1 }] }) === 'string', 'an entry with a pack not a pack id, an alternate past a byte or a field it does not read is refused');
  const big = readPaintRow({ id: 'palette', entries: new Array(PAINT_PALETTE_MOST + 1).fill({ pack: 'tatooine', name: 'x' }) });
  ok(typeof big === 'string' && PAINT_LIMITS.palette === 255, `a palette past ${PAINT_LIMITS.palette} entries (a cell's byte) is refused`);
  // A family's name as the generator's group holds it: not all plain words (Dathomir has one with brackets).
  const dath = 'rock_dath_desertcanyon (mistyfalls)';
  const odd = readPaintRow({ id: 'palette', entries: [{ pack: 'dathomir', name: dath }] });
  const oddWorld = readPaintRow({ id: 'world', weights: { [`dathomir:${dath}`]: [1, 2] }, base: { pack: 'dathomir', name: dath } });
  ok(typeof odd === 'object' && typeof oddWorld === 'object' && typeof readPaintEntry({ pack: 'dathomir', name: dath }) === 'object', 'a family named with brackets is a palette entry, a weights key and a base');
  ok(['a"b', 'a\\b', 'a\nb', '', 'x'.repeat(81)].every((name) => typeof readPaintEntry({ pack: 'dathomir', name }) === 'string'), 'a name with a quote, a backslash or a control character, an empty one and one past 80 characters are refused');
}

// ---------------------------------------------------------------- the world row

{
  const unknown: string[] = [];
  const full = readPaintRow({ id: 'world', follow: false, alternates: false, tint: 'channels', gainCap: 2.5, masks: true, opposite: 'add', clouds: { on: true, strength: 0.6 }, weights: { 'tatooine:sand_dune': [1, 0, 3] }, base: { pack: 'lok', name: 'grss_dsrt_dry_trans' }, packs: ['lok'], wash: { base: [150, 120, 90], bands: [{ above: 500, colour: [240, 240, 245], amount: 0.5 }], noise: { scale: 300, amount: 0.1 } }, later: 1 }, unknown);
  ok(typeof full === 'object' && unknown.join() === 'world.later', 'the world row reads every field (follow, the four layers, weights, base, packs, wash), and names a field it does not read');
  const bad: [Record<string, unknown>, string][] = [
    [{ follow: 1 }, 'follow'],
    [{ tint: 'loud' }, 'tint'],
    [{ gainCap: 0 }, 'gainCap'],
    [{ opposite: 'min' }, 'opposite'],
    [{ clouds: { on: 'yes' } }, 'clouds'],
    [{ weights: { sand: [1] } }, 'weights'],
    [{ weights: { 'tatooine:sand': [-1] } }, 'weights'],
    [{ weights: { 'tatooine:sand': new Array(PAINT_LIMITS.alternates + 1).fill(1) } }, 'weights'],
    [{ base: { pack: 'lok' } }, 'base'],
    [{ packs: 'lok' }, 'packs'],
    [{ wash: { base: [1, 2] } }, 'wash'],
  ];
  ok(bad.every(([o, k]) => {
    const r = readPaintRow({ id: 'world', ...o });
    return typeof r === 'string' && r.includes(k);
  }), `each field refused in words that name it (${bad.length} cases)`);
  const kept = paintWithExtras({ id: 'world', follow: true }, { id: 'world', follow: false, later: { x: 1 } });
  ok(kept.follow === true && JSON.stringify(kept.later) === '{"x":1}', 'a field this build does not read is kept beside a world row written over it');
  ok(samePaintRow({ id: 'world', follow: true, at: 5 }, { id: 'world', follow: true, at: 5 }) && !samePaintRow({ id: 'world', follow: true, at: 5 }, { id: 'world', follow: false, at: 5 }), 'two rows are the same where their fields read the same');
}

// ---------------------------------------------------------------- the reader and the writer

{
  const fam = new Uint8Array(16384);
  fam.fill(1, 400, 700);
  fam.fill(2, 9000, 9010);
  const col = new Uint8Array(16384 * 4);
  col.set([255, 128, 64, 192], 50 * 4);
  const rows: Record<string, unknown>[] = [
    { id: 'world', follow: false, at: 3 },
    { id: 'fam:3,-2', rle: familyRle(fam), at: 1 },
    { id: 'palette', entries: [{ pack: W, name: 'sand' }, { pack: W, name: 'rock', child: 1 }], at: 2 },
    { id: 'col:3,-2', rle: colourRle(col), at: 1 },
  ];
  const text = paintFileText(W, rows);
  const lines = text.split('\n');
  ok(/"cell": 4,/.test(text) && /"tile": 512,/.test(text) && /"frame": "raw",/.test(text), 'the writer\'s header says the raw frame, 4 m cells (taken from the tiles) and 512 m tiles');
  const ids = lines.filter((l) => l.startsWith('    {')).map((l) => /"id": "([^"]+)"/.exec(l)![1]);
  ok(ids.join() === 'col:3,-2,fam:3,-2,palette,world', `one line a row, sorted by id (${ids.join(', ')})`);
  const read = readPaintFile(text, W, 'ground');
  ok(!read.problem && read.rows.length === 4 && !read.skipped.length && read.cell === 4, 'it reads back whole, nothing skipped');
  ok(paintFileText(W, read.rows as unknown as Record<string, unknown>[]) === text, 'and written again it is the same text to the byte');
  const loaded = paintOfRead(read);
  ok(loaded.paint.cell === 4 && sameBytes(loaded.paint.fam.get(paintTileNumber(3, -2))!, fam) && sameBytes(loaded.paint.col.get(paintTileNumber(3, -2))!, col) && loaded.entries.length === 2 && loaded.entries[1].child === 1 && loaded.paint.follow === false, 'made into a paint: its tiles decoded byte for byte, its palette, and follow off from the world row');
  // 8 m cells.
  const eight = new Uint8Array(4096);
  eight[5] = 1;
  const text8 = paintFileText(W, [{ id: 'palette', entries: [{ pack: W, name: 'sand' }] }, { id: 'fam:0,0', rle: familyRle(eight) }]);
  const read8 = readPaintFile(text8, W, 'ground');
  ok(/"cell": 8,/.test(text8) && read8.cell === 8 && paintOfRead(read8).paint.cell === 8 && paintOfRead(read8).paint.n === 64, 'a file of 8 m cells is written as one, reads as one and is laid as 8 m cells');
  // The header held.
  const wrong = (from: string, to: string) => readPaintFile(text.replace(from, to), W, 'ground').problem;
  ok(!!wrong('"version": 1', '"version": 2') && !!wrong('"world": "tatooine"', '"world": "naboo"') && !!wrong('"frame": "raw"', '"frame": "game"') && !!wrong('"cell": 4', '"cell": 6') && !!wrong('"tile": 512', '"tile": 256'), 'a file of another version, world, frame, cell or tile is refused whole');
  ok(!!readPaintFile(text, 'space_tatooine', 'space').problem && /later pass/.test(readPaintFile(text, 'space_tatooine', 'space').problem!), 'a space zone keeps no paint');
  // Rows skipped and named.
  const past = new Uint8Array(16384);
  past[0] = 3;
  const messy = paintFileText(W, [...rows, { id: 'fam:9,9', rle: familyRle(past) }, { id: 'col:0,0', rle: 'zz' }]);
  const twice = messy.replace('"id": "world"', '"id": "world"').replace('\n  ]', ',\n    { "id": "world", "follow": true }\n  ]');
  const r2 = readPaintFile(twice, W, 'ground');
  ok(r2.skipped.some((s) => s.id === 'fam:9,9' && /palette entry 3/.test(s.why)) && r2.skipped.some((s) => s.id === 'col:0,0') && r2.skipped.some((s) => s.id === 'world' && /second row/.test(s.why)) && r2.rows.length === 4, `a family cell naming an entry past the palette, a bad row and a second row under one id are skipped and named (${r2.skipped.length})`);
  ok(PAINT_LIMITS.rows === 65536 && PAINT_LIMITS.weights === 512 && PAINT_LIMITS.alternates === 64, 'the backstops: 65,536 rows, 512 weighted families of at most 64 alternates');
  // The rows the game holds, with the bytes the bar notes.
  const held = new PaintRows();
  held.takeAll(read.rows);
  const bytes = held.bytes;
  held.land([{ id: 'world', follow: true }], ['col:3,-2']);
  ok(held.size === 3 && held.get('world') && (held.get('world') as { follow?: boolean }).follow === true && held.bytes < bytes && held.bytes > 0, `the rows held land a write's answer by id, and the bytes follow (${bytes} to ${held.bytes})`);
}

// ---------------------------------------------------------------- the flora's rows (the fourth wave)

{
  // Every class's word and shape read as itself, keep and clear among them (the first cut read both as refusals).
  const named = { pack: W, name: 'grass' };
  const whole = { trees: 'keep', plants: 'clear', grass: { add: named, density: 0.5 }, far: { thin: 0.25 }, roads: true };
  const r = readFloraRecipe(whole);
  ok(typeof r === 'object' && JSON.stringify(r) === JSON.stringify(whole), 'a recipe reads every class as written: keep, clear, an add with its density, a thin, and roads');
  ok(JSON.stringify(readFloraRecipe({ trees: 'clear', plants: 'clear', grass: 'clear', far: 'clear' })) === '{"trees":"clear","plants":"clear","grass":"clear","far":"clear"}' && JSON.stringify(readFloraRecipe({ trees: { remove: named } })) === JSON.stringify({ trees: { remove: named } }) && JSON.stringify(readFloraRecipe({})) === '{}', 'a recipe clearing all four, one removing a family and one of nothing read as themselves');
  const bad: [unknown, RegExp][] = [
    [{ shrubs: 'clear' }, /shrubs/],
    [{ trees: 'burn' }, /keep, clear/],
    [{ trees: { thin: 1.5 } }, /thin/],
    [{ trees: { add: named, density: -1 } }, /density/],
    [{ trees: { add: named, density: PAINT_LIMITS.density + 1 } }, /density/],
    [{ trees: { add: { pack: W } } }, /pack, name/],
    [{ trees: { remove: named, density: 1 } }, /remove/],
    [{ roads: 'yes' }, /roads/],
    ['clear', /object/],
  ];
  ok(bad.every(([v, re]) => {
    const s = readFloraRecipe(v);
    return typeof s === 'string' && re.test(s);
  }), `a recipe of a class this build does not read, a word not a class's, a thin past one, a density out of range, a family not named whole, a remove carrying more, a roads not true or false, or not an object is refused in words (${bad.length} cases)`);
  // A recipes row and a flora tile, written, read back to the byte, and made into a paint.
  const flo = new Uint8Array(16384 * 2);
  for (let i = 200; i < 900; i++) flo.set([1 + (i % 2), 40 + (i % 200)], i * 2);
  const rle = floraRle(flo);
  ok(sameBytes(floraCells(rle, 16384) as Uint8Array, flo) && sameBytes(tileCells('flo', rle, 16384) as Uint8Array, flo), 'a flora tile (recipe, amount a cell) reads back byte for byte');
  ok(typeof floraCells('0100*16384', 16384) === 'string', "a cell naming a recipe at no amount is refused (a cell of nothing is nought)");
  const recipes = [{ trees: 'clear' as const }, { grass: { add: named } }];
  const text = paintFileText(W, [{ id: 'recipes', entries: recipes }, { id: 'flo:0,0', rle }]);
  const read = readPaintFile(text, W, 'ground');
  ok(!read.problem && read.rows.length === 2 && !read.skipped.length && paintFileText(W, read.rows as unknown as Record<string, unknown>[]) === text, 'a recipes row and a flora tile read back whole and write again to the byte');
  const loaded = paintOfRead(read);
  ok(JSON.stringify(loaded.recipes) === JSON.stringify(recipes) && sameBytes(loaded.paint.flo.get(paintTileNumber(0, 0))!, flo), 'made into a paint: its recipes and its flora tile, byte for byte');
  const copy = copyRecipes(loaded.recipes);
  (copy[1].grass as { add: { name: string } }).add.name = 'other';
  ok((loaded.recipes[1].grass as { add: { name: string } }).add.name === 'grass', 'a copy of the recipes shares nothing with them');
  // A flora cell naming a recipe the row has not got is skipped and named, as a family cell past the palette is.
  const past = new Uint8Array(16384 * 2);
  past.set([3, 255], 0);
  const r3 = readPaintFile(paintFileText(W, [{ id: 'recipes', entries: recipes }, { id: 'flo:1,0', rle: floraRle(past) }]), W, 'ground');
  ok(r3.skipped.some((s) => s.id === 'flo:1,0' && /recipe 3/.test(s.why)) && r3.rows.length === 1, 'a flora cell naming a recipe past the recipes row is skipped and named');
  ok(PAINT_LIMITS.recipes === 255 && PAINT_LIMITS.density === 16, 'the backstops: 255 recipes (a cell\'s byte), an add of density 16 at the most');
}

// ---------------------------------------------------------------- the batch over the paint file

{
  const worlds = new Map([[W, 'ground'], ['space_tatooine', 'space']] as const);
  let clock = 1_800_000_000_000;
  const ctx = (): PlacementCtx => ({ worlds, now: (clock += 1000), hash: (t: string) => String(t.length) });
  const base: Record<string, string | null> = { story: null, world: null, paint: null };
  const fam = new Uint8Array(16384);
  fam.fill(1, 0, 64);
  const tile = { rle: familyRle(fam) };
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'palette', entries: [{ pack: W, name: 'sand' }] } }, { file: 'paint', put: { id: 'fam:0,0', ...tile } }] }, base, ctx());
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'paint' && /"id": "fam:0,0"/.test(put.writes[0].text ?? '') && /"id": "palette"/.test(put.writes[0].text ?? ''), 'a palette and a tile put in one write go into the paint file together');
  const file = put.writes[0].text!;
  const now = { ...base, paint: file };
  const nothing = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'fam:1,0', rle: '0*16384' } }] }, now, ctx());
  ok(nothing.status === 400 && !nothing.writes.length, 'a tile of nothing is refused (it is taken out instead)');
  const pastPalette = new Uint8Array(16384);
  pastPalette[0] = 2;
  const orphan = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'fam:1,0', rle: familyRle(pastPalette) } }] }, now, ctx());
  ok(orphan.status === 409 && /palette entry 2/.test((orphan.body as { why: string }).why) && !orphan.writes.length, 'a write that would leave a cell naming an entry past the palette is refused as the asker\'s (409, before the read-back)');
  const eight = new Uint8Array(4096);
  eight[0] = 1;
  const mixed = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'fam:1,0', rle: familyRle(eight) } }] }, now, ctx());
  ok(mixed.status === 409 && /two cells/.test((mixed.body as { why: string }).why) && !mixed.writes.length, 'and so is a tile of another cell than the file\'s'); 
  const space = applyPlacementOp({ op: 'batch', world: 'space_tatooine', edits: [{ file: 'paint', put: { id: 'fam:0,0', ...tile } }] }, base, ctx());
  ok(space.status === 409 && !space.writes.length, "a space zone's paint is refused: the ground's alone");
  const asRead = readPaintFile(file, W, 'ground').rows.find((r) => r.id === 'fam:0,0') as PaintTileRow;
  const changedSince = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', delete: 'fam:0,0', was: { ...asRead, rle: familyRle(pastPalette.fill(1, 0, 3)) } as unknown as PaintRow }] }, now, ctx());
  ok(changedSince.status === 409 && !changedSince.writes.length, 'an undo naming a tile as it no longer stands is refused, never written over it');
  const gone = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', delete: 'fam:0,0', was: asRead as unknown as PaintRow }, { file: 'paint', delete: 'palette' }] }, now, ctx());
  ok(gone.status === 200 && gone.writes.length === 1 && gone.writes[0].text === null, 'the file goes with its last row');

  // The flora's (the fourth wave's): a flora tile whose cells name a recipe past the recipes row is refused as the asker's,
  // which is the refusal a dev server still running the third wave's endpoint never makes (and why it must be restarted).
  const two = [{ trees: 'clear' }, { grass: 'clear' }];
  const withRecipes = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'recipes', entries: two } }] }, base, ctx());
  ok(withRecipes.status === 200 && /"id": "recipes"/.test(withRecipes.writes[0]?.text ?? ''), 'a recipes row of two is written');
  const holdsTwo = { ...base, paint: withRecipes.writes[0].text! };
  const three = new Uint8Array(16384 * 2);
  three.set([3, 255], 0);
  three.set([1, 200], 2);
  const pastRecipes = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'flo:1,0', rle: floraRle(three) } }] }, holdsTwo, ctx());
  ok(pastRecipes.status === 409 && /recipe 3/.test((pastRecipes.body as { why: string }).why) && !pastRecipes.writes.length, `a flora tile naming recipe 3 into a file holding two is refused as the asker's (409, "${(pastRecipes.body as { why: string }).why}"), and nothing is written`);
  const together = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'recipes', entries: [...two, { plants: 'clear' }] } }, { file: 'paint', put: { id: 'flo:1,0', rle: floraRle(three) } }] }, holdsTwo, ctx());
  const back = together.writes[0]?.text ? readPaintFile(together.writes[0].text, W, 'ground') : null;
  ok(together.status === 200 && !!back && paintOfRead(back).recipes.length === 3 && back.rows.some((r) => r.id === 'flo:1,0') && !back.skipped.length, 'the recipes row grown to three and that tile put in one batch are taken together, and read back whole');
  const oneLess = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'paint', put: { id: 'recipes', entries: two } }] }, { ...base, paint: together.writes[0].text! }, ctx());
  ok(oneLess.status === 409 && /recipe 3/.test((oneLess.body as { why: string }).why) && !oneLess.writes.length, 'and a recipes row cut back under a cell that names its last recipe is refused the same way');
}

console.log(`\npaintFile: ${checks} checks passed`);
