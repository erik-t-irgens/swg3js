// The deeds a player buys a building with: the footprint format, the four-way join, and the two
// copies of the patch arithmetic agreeing.
//
// The footprint reader is checked against **every** footprint in the owner's archives where they
// are to hand, because it is a format nobody has documented for us and 86 files that all parse to
// the byte is the only evidence that the reading is right.
//
// Run: node tools/swg/tests/deeds.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { footprintEntry, footprintFaults, footprintPatch, footprintSize, readFootprint } from '../sfp.mjs';
import { OUR_DEEDS, deedCounts, joinDeeds, ourDeeds, wordsFrom } from '../deeds.mjs';
import { patchOfFootprint } from '../../../src/world/housePlace.ts';
import { DEED_PACK_VERSION, deedLine, deedOfModel, wrongWorld, type DeedRow } from '../../../src/world/deeds.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { W, chunk, encode, form } from './iffWriter.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
/**
 * The walk-in models the gallery carries that no deed row makes, Core3's or ours (measured on the pilot conversion
 * of SOE complete's first wave, SOE's final names list applied): the sandcrawler house, the shared and player-city
 * merchant tents (Core3's three merchant tent deeds make the planets' own) and the three image designer tents.
 */
const HOUSES_WITHOUT_A_DEED = new Set<string>(['ply_all_sandcrawler_house', 'ply_all_merchant_tent_s01', 'ply_pgc_merchant_tent_s01', 'ply_corl_idesigner_tent_s01', 'ply_nboo_idesigner_tent_s01', 'ply_tato_idesigner_tent_s01']);

/** A footprint file built by hand, so the reader is checked against bytes we chose. */
function makeSfp(width: number, height: number, pivotX: number, pivotZ: number, cw: number, ch: number, rows: string[]): Uint8Array {
  const info = new W().i32(width).i32(height).i32(pivotX).i32(pivotZ).f32(cw).f32(ch).bytes();
  const prnt = new Uint8Array([...rows.map((r) => [...r].map((c) => c.charCodeAt(0)).concat(0)).flat()]);
  return encode(form('FOOT', form('0000', chunk('INFO', info), chunk('PRNT', prnt))));
}

// ---------------------------------------------------------------- the format

{
  const f = readFootprint(makeSfp(3, 3, 1, 1, 4, 4, ['HFH', 'FFF', 'HFH']))!;
  ok(!!f, 'a footprint reads');
  ok(f.width === 3 && f.height === 3, 'with its cells across and along');
  ok(f.pivotX === 1 && f.pivotZ === 1, 'and which cell the origin stands on');
  ok(f.cellWidth === 4 && f.cellHeight === 4, 'and how big a cell is, which is not always eight');
  ok(f.rows.join('|') === 'HFH|FFF|HFH', 'and one string a row, one character a cell');
  ok(footprintFaults(f).length === 0, 'and nothing wrong with it');
}

{
  ok(readFootprint(new Uint8Array([1, 2, 3])) === null, 'something that is not a footprint reads as none');
  ok(footprintFaults(null).length === 1, 'and says so rather than throwing');
  const short = readFootprint(makeSfp(3, 3, 1, 1, 4, 4, ['HFH', 'FFF']))!;
  ok(footprintFaults(short).some((w) => w.includes('rows')), 'a file whose rows do not match its counts is reported');
  const outside = readFootprint(makeSfp(2, 2, 5, 0, 8, 8, ['FF', 'FF']))!;
  ok(footprintFaults(outside).some((w) => w.includes('outside')), 'and so is a pivot outside its own grid');
  const odd = readFootprint(makeSfp(1, 1, 0, 0, 8, 8, ['X']))!;
  ok(footprintFaults(odd).some((w) => w.includes('never use')), 'and so is a character the retail files never use');
}

// ---------------------------------------------------------------- the patch

{
  const f = readFootprint(makeSfp(3, 3, 1, 1, 8, 8, ['FFF', 'FFF', 'FFF']))!;
  const p = footprintPatch(f);
  ok(p.hx === 12 && p.hz === 12, 'three cells of eight metres is twenty-four across, so twelve each way');
  ok(Math.abs(p.cx) < 1e-9 && Math.abs(p.cz) < 1e-9, 'and a pivot on the middle cell leaves the origin in the middle');
  const size = footprintSize(f);
  ok(size.x === 24 && size.z === 24, 'and the size is the whole of it');
}

{
  // The Corellia medium house, as the archives really have it: three cells by four, of eight metres,
  // with the origin one cell in. That puts the building's far end twenty metres from the doorstep
  // and its near end twelve, which is why the offset exists at all.
  const f = readFootprint(makeSfp(3, 4, 1, 1, 8, 8, ['HFF', 'FFF', 'FFF', 'FFF']))!;
  const p = footprintPatch(f);
  ok(p.hx === 12 && p.hz === 16, 'a three by four grid of eight metres is 24 by 32');
  ok(p.cx === 0 && p.cz === 4, 'and the origin one cell in along z leaves the middle four metres past it');
}

{
  // Two copies of this arithmetic exist on purpose -- one the converter's, one the game's -- and
  // they are compared rather than trusted, because a placement drawn by one and tested by the other
  // would be wrong by metres with nothing to say so.
  for (const [w, h, px, pz, cw, ch] of [
    [3, 4, 1, 1, 8, 8],
    [7, 5, 3, 2, 8, 8],
    [1, 1, 0, 0, 3, 2],
    [18, 18, 8, 8, 32, 32],
    [9, 9, 4, 4, 4, 4],
  ] as number[][]) {
    const f = readFootprint(makeSfp(w, h, px, pz, cw, ch, Array.from({ length: h }, () => 'F'.repeat(w))))!;
    const a = footprintPatch(f);
    const b = patchOfFootprint({ width: w, height: h, pivotX: px, pivotZ: pz, cellWidth: cw, cellHeight: ch });
    ok(
      Math.abs(a.hx - b.hx) < 1e-9 && Math.abs(a.hz - b.hz) < 1e-9 && Math.abs(a.cx - b.cx) < 1e-9 && Math.abs(a.cz - b.cz) < 1e-9,
      `the converter and the game agree about a ${w}x${h} grid of ${cw}x${ch} m with its pivot at ${px},${pz}`,
    );
  }
}

{
  const f = readFootprint(makeSfp(2, 1, 0, 0, 8, 8, ['FH']))!;
  const e = footprintEntry(f);
  ok(e.w === 2 && e.h === 1 && e.px === 0 && e.cw === 8 && e.rows.join('') === 'FH', 'what a pack carries is the whole of a footprint and nothing else');
}

// ---------------------------------------------------------------- the join

{
  const deeds = [
    { key: 'object_tangible_deed_a', template: 'object/tangible/deed/shared_a.iff', makes: 'object/building/player/a.iff', id: 'a_deed' },
    { key: 'object_tangible_deed_b', template: 'object/tangible/deed/shared_b.iff', makes: 'object/building/player/b.iff', id: 'b_deed' },
  ];
  const buildings = new Map([['object/building/player/a.iff', { lots: 3, upkeep: 40, zones: ['corellia'] }]]);
  const sfp = makeSfp(3, 3, 1, 1, 8, 8, ['FFF', 'FFF', 'FFF']);
  const out = joinDeeds(deeds, buildings, {
    has: (p: string) => p === 'footprint/a.sfp',
    read: () => sfp,
    templateString: (t: string, names: string[]) => {
      if (t === 'object/building/player/a.iff' && names[0] === 'portalLayoutFilename') return 'appearance/a_house.pob';
      if (t === 'object/building/player/a.iff' && names[0] === 'structureFootprintFileName') return 'footprint/a.sfp';
      return null;
    },
    name: (t: string) => (t.includes('shared_a') ? 'A House Deed' : null),
    desc: () => '',
    hasModel: (id: string) => id === 'a_house',
  });
  const a = out.rows.find((r) => r.id === 'a_deed')!;
  const b = out.rows.find((r) => r.id === 'b_deed')!;
  ok(a.model === 'a_house', 'a deed reaches its model through the building it makes and that building\'s portal layout');
  ok(a.foot?.w === 3 && a.patch?.hz === 12, 'and carries the grid the client placed it on, and the patch that comes of it');
  ok(a.lots === 3 && a.upkeep === 40 && a.zones[0] === 'corellia', 'and what the server said it cost in lots, upkeep and worlds');
  ok(a.name === 'A House Deed' && a.named, 'and the name the game gave it');
  ok(b.model === null && b.foot === null, 'a deed whose building this game has no model for is written with none rather than dropped');
  ok(b.name === wordsFrom('b_deed') && !b.named, 'and one the string tables do not name gets words made from its key, marked as made up');
  ok(deedCounts(out.rows).withModel === 1, 'and the counts say how many of them can really be put down');
}

{
  ok(wordsFrom('corellia_house_small_deed') === 'Corellia House Small', 'words out of a key drop the deed and capitalise');
}

// ---------------------------------------------------------------- the deeds of ours
{
  // Every client house deed Core3 never knew, paired by the templates' own names: one row a building, the first listed
  // deed winning, none for a building Core3 already makes or a deed the archives have not got.
  const [d0, b0] = OUR_DEEDS[0];
  const huts = OUR_DEEDS.filter(([, b]) => b === 'shared_player_house_wod_ns_hut.iff');
  ok(OUR_DEEDS.length === 30 && new Set(OUR_DEEDS.map(([, b]) => b)).size === 28 && huts.length === 2, `the table is 30 deed templates over 28 buildings, the hut deeds two each (${OUR_DEEDS.length}, ${new Set(OUR_DEEDS.map(([, b]) => b)).size})`);
  const held = new Set(OUR_DEEDS.map(([d]) => d));
  const buildingOf = (file: string) => `object/building/player/${file}`;
  // Core3 names the building its deed makes by the server's template, with no `shared_` (`generatedObjectTemplate`).
  const serverPath = buildingOf(OUR_DEEDS[1][1]).replace('/shared_', '/');
  const rows = ourDeeds({ has: (p: string) => held.has(p), buildingOf, known: new Set([serverPath]) });
  ok(rows.length === 27 && rows.every((r) => r.ours) && new Set(rows.map((r) => r.makes)).size === rows.length && !rows.some((r) => r.makes === buildingOf(OUR_DEEDS[1][1])), `one row a building, every one marked ours, a building Core3 already makes (named by its server template, ${serverPath}) left out (27 of 28)`);
  ok(rows.some((r) => r.template === huts[0][0]) && !rows.some((r) => r.template === huts[1][0]), 'where two deeds make one building, the first listed is the row');
  ok(ourDeeds({ has: (p: string) => p !== d0, buildingOf, known: new Set() }).every((r) => r.makes !== buildingOf(b0)), 'a deed the archives have not got stands nothing');
  const sfp = makeSfp(2, 2, 0, 0, 4, 4, ['FF', 'FF']);
  const joined = joinDeeds(rows.slice(0, 1), new Map([[rows[0].makes, { lots: 9, upkeep: 99, zones: ['naboo'] }]]), {
    has: () => true,
    read: () => sfp,
    templateString: (t: string, names: string[]) => (names[0] === 'portalLayoutFilename' && t === rows[0].makes ? 'appearance/ply_test_house.pob' : names[0] === 'structureFootprintFileName' ? 'footprint/test.sfp' : null),
    name: (t: string) => (t === rows[0].makes ? 'TEST House' : null),
    desc: () => '',
    hasModel: () => true,
  });
  const o = joined.rows[0];
  ok(o.ours === true && o.lots === 0 && o.upkeep === 0 && o.zones.length === 0, "a deed of ours carries no lots, no upkeep and every world, whatever is said of its building");
  ok(o.name === 'TEST House' && o.named && o.model === 'ply_test_house' && o.foot?.w === 2, "and takes its building's name where its own has none, its model and footprint from the building");
  const core3Row = joinDeeds([{ key: 'k', template: 'object/tangible/deed/shared_c.iff', makes: 'object/building/player/c.iff', id: 'c_deed' }], new Map(), { has: () => false, read: () => sfp, templateString: () => null, name: () => null, desc: () => '', hasModel: () => false }).rows[0];
  ok(!('ours' in core3Row), "a Core3 deed is written as it always was, with no `ours`");
  // The pack stays version 1: `ours` is a field an older reader passes over, so a build before this one still reads it.
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  ok(/const DEED_PACK_VERSION = 1;/.test(cli) && DEED_PACK_VERSION === 1, 'the deeds pack is version 1 on both sides');
  // What the Housing tab says under a deed of ours, and under any other exactly as before.
  const foot = { w: 2, h: 2, px: 0, pz: 0, cw: 8, ch: 8, rows: ['FF', 'FF'] };
  const base: DeedRow = { id: 'd', name: 'd', named: true, desc: '', makes: '', model: 'ply_house', layout: null, lots: 2, upkeep: 15, zones: [], foot, patch: null };
  ok(deedLine({ ...base, ours: true, lots: 0, upkeep: 0 }) === '16 by 16 m · lots and upkeep: not known (ours)', 'a deed of ours says its lots and upkeep are not known');
  ok(deedLine(base) === '16 by 16 m · 2 lots · 15 a day' && deedLine({ ...base, lots: 0, upkeep: 0 }) === '16 by 16 m · no lots · 0 a day', 'and any other deed reads as it always did');
}

// ---------------------------------------------------------------- the real archives

{
  const pack = join('assets-private', 'deeds.json');
  if (!existsSync(pack)) {
    note('no deeds.json here, so the real deeds are not read (npm run swg -- deeds @SWG assets-private --retail-only)');
  } else {
    const d = JSON.parse(readFileSync(pack, 'utf8')) as { version: number; counts: Record<string, number>; deeds: { id: string; name: string; model: string | null; foot: { w: number; h: number; px: number; pz: number; cw: number; ch: number; rows: string[] } | null; patch: { hx: number; hz: number } | null; lots: number }[] };
    ok(d.version === 1 && d.deeds.length > 0, `the pack carries ${d.deeds.length} deeds that make a building`);
    let worst = { id: '', area: 0 };
    for (const row of d.deeds) {
      if (!row.foot) continue;
      const f = { width: row.foot.w, height: row.foot.h, pivotX: row.foot.px, pivotZ: row.foot.pz, cellWidth: row.foot.cw, cellHeight: row.foot.ch, rows: row.foot.rows };
      assert.ok(footprintFaults(f).length === 0, `${row.id}: its footprint is sound`);
      const p = patchOfFootprint(f);
      assert.ok(Math.abs(p.hx - (row.patch?.hx ?? 0)) < 1e-3 && Math.abs(p.hz - (row.patch?.hz ?? 0)) < 1e-3, `${row.id}: the patch the pack carries is the one the game works out`);
      const area = p.hx * p.hz * 4;
      if (area > worst.area) worst = { id: row.id, area };
    }
    passed++;
    console.log('ok   every real footprint in the pack is sound and its patch is the one the game works out');
    const placeable = d.deeds.filter((r) => r.model);
    note(`${placeable.length} of ${d.deeds.length} deeds reach a model this game carries; the rest are buildings with no walkable interior or ones the gallery has not converted`);
    note(`the biggest is ${worst.id} at ${Math.round(worst.area)} square metres`);
    const houses = placeable.filter((r) => /house/.test(r.id));
    note(`${houses.length} of them are houses, from ${Math.min(...houses.map((h) => h.lots))} to ${Math.max(...houses.map((h) => h.lots))} lots`);
    // Every walk-in house the gallery carries is some deed's model, Core3's or ours, or a named exception -- held only
    // on a pack written with the deeds of ours (from SOE complete's first wave), which a pack from before has not got.
    const gallery = join('assets-private', 'gallery', 'manifest.json');
    const ours = (d.deeds as { ours?: boolean }[]).filter((r) => r.ours).length;
    if (!ours) note('the deeds pack carries no deeds of ours (converted before them): the gallery\'s houses are not held to it');
    else if (!existsSync(gallery)) note('no gallery here: its houses are not held to the deeds');
    else {
      const models = (JSON.parse(readFileSync(gallery, 'utf8')).categories?.layout ?? []) as { id: string; cells?: unknown[] }[];
      const made = new Set(d.deeds.map((r) => r.model).filter(Boolean));
      const walkIn = models.filter((m) => /^ply_/.test(m.id) && (m.cells?.length ?? 0) > 1 && !/construction/.test(m.id));
      const lacking = walkIn.filter((m) => !made.has(m.id) && !HOUSES_WITHOUT_A_DEED.has(m.id)).map((m) => m.id);
      ok(!lacking.length, `every walk-in house the gallery carries is a deed's model, Core3's or one of the ${ours} of ours, or a named exception (${walkIn.length}${lacking.length ? `; lacking ${lacking.join(', ')}` : ''})`);
    }
  }
}

// ---------------------------------------------------------------- a house picked back up, by its model (W7)
{
  // A house already standing is taken up again by the deed that makes its model, for the grid it was placed on: one
  // that may stand on this world first, then any with a footprint, and none where no deed with a footprint makes it.
  const foot = { w: 2, h: 2, px: 0, pz: 0, cw: 8, ch: 8, rows: ['FF', 'FF'] };
  const row = (id: string, model: string | null, zones: string[], withFoot = true): DeedRow => ({ id, name: id, named: true, desc: '', makes: '', model, layout: null, lots: 1, upkeep: 0, zones, foot: withFoot ? foot : null, patch: null });
  const deeds = [row('naboo_only', 'ply_house', ['naboo']), row('footless', 'ply_house', [], false), row('tatooine_one', 'ply_house', ['tatooine']), row('other', 'ply_shop', [])];
  ok(deedOfModel('ply_house', 'tatooine', deeds)?.id === 'tatooine_one', "the deed that may stand on this world is the one a house here is taken up by");
  ok(deedOfModel('ply_house', 'lok', deeds)?.id === 'naboo_only', 'with none for this world, any deed of its model with a footprint');
  ok(deedOfModel('ply_tower', 'tatooine', deeds) === null && deedOfModel('ply_house', 'lok', [deeds[1]]) === null, 'and none where no deed with a footprint makes it: judged on its model\'s own box, as it was put down');
}

// ---------------------------------------------------------------- which worlds a deed may stand on
{
  const foot = { w: 2, h: 2, px: 0, pz: 0, cw: 8, ch: 8, rows: ['FF', 'FF'] };
  const row = (zones: string[]): DeedRow => ({ id: 'd', name: 'd', named: true, desc: '', makes: '', model: 'ply_house', layout: null, lots: 1, upkeep: 0, zones, foot, patch: null });
  ok(wrongWorld(row(['naboo']), 'naboo') === null && wrongWorld(row([]), 'lok') === null, 'a deed stands on the worlds it names, and one that names none stands anywhere');
  ok(/may only stand on naboo/.test(wrongWorld(row(['naboo']), 'tatooine') ?? ''), 'and is refused on a game world it does not name, in words');
  const custom = PLANETS.find((p) => p.dem);
  ok(!!custom && wrongWorld(row(['naboo']), custom.id) === null, `while a world of our own whose ground is real elevation (${custom?.id}) takes every deed`);
}

console.log(`\n${passed} checks passed`);
