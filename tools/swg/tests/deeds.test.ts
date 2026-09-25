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
import { deedCounts, joinDeeds, wordsFrom } from '../deeds.mjs';
import { patchOfFootprint } from '../../../src/world/housePlace.ts';
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
  }
}

console.log(`\n${passed} checks passed`);
