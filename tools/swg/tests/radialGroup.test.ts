// The terrain's radial group and its two affectors, read (materials and ground pass, wave 5b).
//
// Every terrain carries a third flora system the game never read: the radial group (RGRP), families of grass,
// flowers, reeds and ferns and the flat tree cards on the far hills, each child a shader with its size in
// metres, painted by the near affector (AFDN) and the far one (AFDF). The checks:
//
//   1. a group built in memory reads every field in the engine's own order, for version 0004 (every retail
//      world's) and the older ones the engine still loads (0003, 0002, 0000), and an empty group reads empty
//   2. every converted world (SWG3JS_PACKS, else assets-private): RGRP reads to the byte with 0 bytes left in
//      every chunk, the families and children per world are the research's own counts (168 and 602 over the
//      19 worlds), every AFDN and AFDF is version 0002 with a 20-byte DATA, their counts are the research's
//      (855 and 296), every family they name resolves in the radial group, and none of them is inert any more
//
// Run: node tools/swg/tests/radialGroup.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import { RadialGroup } from '../../../src/swg/terrain/flora.ts';
import { AffectorFloraDynamic, AffectorInert, type Layer } from '../../../src/swg/terrain/generator.ts';
import { chunkChild, formChild, isForm, parseIff, type IffForm } from '../../../src/swg/terrain/iff.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

const read = (bytes: Uint8Array) => {
  const g = new RadialGroup();
  g.load(parseIff(bytes));
  return g;
};

// ---------------------------------------------------------------- 1. a group built in memory

{
  const child4 = (w: W, shader: string, n: number) =>
    w.str(shader).f32(n).f32(10 + n).f32(0.5).f32(0.75).f32(1).f32(1.5).i32(n & 1).i32(1).f32(0.13).f32(0.3).i32(1).i32(n === 2 ? 1 : 0);
  const fam4 = (id: number, name: string, density: number, children: string[]) => {
    const w = new W().i32(id).str(name).u8(255).u8(255).u8(0).f32(density).i32(children.length);
    children.forEach((c, i) => child4(w, c, i + 1));
    return chunk('RFAM', w.bytes());
  };
  const g = read(encode(form('RGRP', form('0004', fam4(3, 'meadow', 0.5, ['radl_grass_a', 'radl_flower_b']), fam4(7, 'reeds', 1, ['radl_reed'])))));
  ok(g.version === 4 && g.families.size === 2 && g.childCount === 3 && g.leftover === 0, 'version 0004: two families, three children, nothing left over');
  const m = g.families.get(3)!;
  ok(m.name === 'meadow' && m.density === 0.5 && m.color.join(',') === '255,255,0', 'a family: its id, name, colour and density');
  const a = m.children[0];
  const b = m.children[1];
  ok(a.shader === 'radl_grass_a' && a.weight === 1 && a.distance === 11 && a.minWidth === 0.5 && a.maxWidth === 0.75 && a.minHeight === 1 && a.maxHeight === 1.5, 'a child: shader, weight, distance, then min and max width and height, in that order');
  ok(a.maintainAspect && !b.maintainAspect && a.shouldSway && Math.abs(a.displacement - 0.13) < 1e-6 && Math.abs(a.period - 0.3) < 1e-6 && a.alignToTerrain && !a.createPlus && b.createPlus, 'then keep-aspect, sway, displacement, period, align to terrain and the crossed second quad');
  ok(m.choose(0)!.shader === 'radl_grass_a' && m.choose(1)!.shader === 'radl_flower_b' && m.choose(0.3)!.shader === 'radl_grass_a' && m.choose(0.34)!.shader === 'radl_flower_b', 'a choice picks by weight, the first whose weight covers what is left (weights 1 and 2: 0..1/3 the first)');
  ok(g.createRadial(7, 0.5)!.shader === 'radl_reed' && g.createRadial(9, 0.5) === null, 'a family id picks from its family, and a missing one picks nothing');

  // 0003: one width and height, sway, align and plus; 0002: sway; 0000: no density.
  const g3 = read(encode(form('RGRP', form('0003', chunk('RFAM', new W().i32(1).str('old').u8(0).u8(0).u8(0).f32(0.8).i32(1).str('s').f32(2).f32(15).f32(0.4).f32(0.9).i32(1).f32(0.2).f32(0.5).i32(0).i32(1).bytes())))));
  const c3 = g3.families.get(1)!.children[0];
  ok(g3.leftover === 0 && c3.minWidth === c3.maxWidth && Math.abs(c3.maxWidth - 0.4) < 1e-6 && Math.abs(c3.minHeight - 0.9) < 1e-6 && c3.shouldSway && c3.createPlus && !c3.alignToTerrain && Math.abs(g3.families.get(1)!.density - 0.8) < 1e-6, 'version 0003: one width and height for both ends, sway, align and plus');
  const g2 = read(encode(form('RGRP', form('0002', chunk('RFAM', new W().i32(1).str('older').u8(0).u8(0).u8(0).f32(1).i32(1).str('s').f32(1).f32(10).f32(1).f32(1).i32(1).f32(0.1).f32(0.2).bytes())))));
  ok(g2.leftover === 0 && g2.families.get(1)!.children[0].shouldSway && !g2.families.get(1)!.children[0].createPlus, 'version 0002: sway and nothing after');
  const g0 = read(encode(form('RGRP', form('0000', chunk('RFAM', new W().i32(4).str('oldest').u8(1).u8(2).u8(3).i32(1).str('s').f32(1).f32(10).f32(2).f32(3).bytes())))));
  ok(g0.leftover === 0 && g0.families.get(4)!.density === 1 && g0.families.get(4)!.children[0].maxHeight === 3, 'version 0000: no density (one, the engine default), one width and height');
  const empty = read(encode(form('RGRP', form('0003'))));
  ok(empty.families.size === 0 && empty.childCount === 0, 'an empty group (every test terrain built in memory carries one) reads empty');
}

// ---------------------------------------------------------------- 2. the converted worlds

/** The research's own counts per world (study 1, read with the engine's layout): families, children, AFDN and AFDF. */
const STUDY: Record<string, [number, number, number, number]> = {
  corellia: [14, 51, 104, 31],
  dantooine: [13, 51, 50, 25],
  dathomir: [17, 63, 81, 24],
  dungeon1: [0, 0, 0, 0],
  endor: [17, 58, 77, 28],
  kashyyyk_dead_forest: [4, 15, 5, 2],
  kashyyyk_hunting: [7, 23, 31, 0],
  kashyyyk_main: [5, 18, 9, 2],
  kashyyyk_north_dungeons: [6, 18, 73, 39],
  kashyyyk_pob_dungeons: [0, 0, 0, 0],
  kashyyyk_rryatt_trail: [4, 12, 42, 18],
  kashyyyk_south_dungeons: [2, 8, 32, 0],
  lok: [8, 23, 28, 8],
  mustafar: [0, 0, 0, 0],
  naboo: [21, 69, 132, 49],
  rori: [15, 56, 39, 13],
  talus: [17, 74, 58, 23],
  tatooine: [5, 11, 47, 4],
  yavin4: [13, 52, 47, 30],
};

/**
 * A world's terrain as SOE's final names list re-issues it (its own manifest's `late` stamp says the pack was
 * converted with the list in the mount), measured on SOE complete's pilot conversion: Dathomir's alone moves, by one
 * AFDN and one AFDF (Lok's re-issued terrain keeps its radial counts, and Tatooine's and Talus's Life Day copies are
 * held back).
 */
const STUDY_LATE: Record<string, [number, number, number, number]> = { dathomir: [17, 63, 82, 25] };
const lateOf = (name: string): boolean => {
  try {
    const s = JSON.parse(readFileSync(join(PACKS, name, 'manifest.json'), 'utf8')).late?.state;
    return s === 'applied' || s === 'final';
  } catch {
    return false;
  }
};

const worlds = groundWorlds();
if (!worlds.length) note(`no converted world under ${PACKS}: only the groups built in memory were checked`);
let lateWorlds = 0;
let families = 0;
let children = 0;
let near = 0;
let far = 0;
for (const name of worlds) {
  const bytes = new Uint8Array(readFileSync(join(PACKS, name, 'terrain.trn')));
  const root = parseIff(bytes);
  const tgen = formChild(formChild(root.children.find(isForm) as IffForm, 'TGEN')!, '0000')!;
  const g = new RadialGroup();
  g.load(formChild(tgen, 'RGRP') ?? null);
  // Every AFDN and AFDF in the raw file, wherever its layer sits.
  const raws: { tag: string; version: string; data: number }[] = [];
  const walk = (f: IffForm) => {
    for (const c of f.children) {
      if (!isForm(c)) continue;
      if (c.type === 'AFDN' || c.type === 'AFDF') {
        const v = c.children.find(isForm) as IffForm;
        raws.push({ tag: c.type, version: v.type, data: chunkChild(v, 'DATA')?.data.length ?? -1 });
      } else walk(c);
    }
  };
  walk(formChild(tgen, 'LYRS')!);
  const t = parseTerrainTemplate(bytes);
  const live: AffectorFloraDynamic[] = [];
  let inert = 0;
  const visit = (layers: readonly Layer[]) => {
    for (const l of layers) {
      for (const a of l.affectors) {
        if (a instanceof AffectorFloraDynamic) live.push(a);
        else if (a instanceof AffectorInert && (a.tag === 'AFDN' || a.tag === 'AFDF')) inert++;
      }
      visit(l.layers);
    }
  };
  visit(t.generator.layers);
  const late = lateOf(name);
  if (late) lateWorlds++;
  const want = (late && STUDY_LATE[name]) || STUDY[name];
  const n = raws.filter((r) => r.tag === 'AFDN').length;
  const f = raws.filter((r) => r.tag === 'AFDF').length;
  ok(g.leftover === 0 && (g.version === 4 || g.families.size === 0), `${name}: RGRP ${g.version >= 0 ? `version 000${g.version}` : 'absent'} reads to the byte (${g.leftover} bytes left)`);
  if (want) ok(g.families.size === want[0] && g.childCount === want[1] && n === want[2] && f === want[3], `${name}: ${g.families.size} families, ${g.childCount} children, ${n} AFDN and ${f} AFDF, the research's ${want.join(', ')}`);
  ok(raws.every((r) => r.version === '0002' && r.data === 20), `${name}: every radial affector is version 0002 with 20 bytes of data`);
  ok(live.length === raws.length && inert === 0, `${name}: all ${raws.length} radial affectors are live, none inert`);
  const unresolved = live.filter((a) => !a.removeAll && !g.families.has(a.familyId)).length;
  ok(unresolved === 0, `${name}: every family a radial affector adds or removes names a radial family (${unresolved} do not)`);
  families += g.families.size;
  children += g.childCount;
  near += n;
  far += f;
}
const dathLate = worlds.includes('dathomir') && lateOf('dathomir') ? 1 : 0;
if (worlds.length === Object.keys(STUDY).length) ok(families === 168 && children === 602 && near === 855 + dathLate && far === 296 + dathLate, `over all nineteen worlds (${lateWorlds} converted with SOE's final names list): ${families} families, ${children} children, ${near} AFDN, ${far} AFDF (168, 602, ${855 + dathLate}, ${296 + dathLate})`);
else note(`${worlds.length} of the nineteen worlds converted: the totals are checked only over all of them`);

console.log(`\n${passed} passed`);
