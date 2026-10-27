// The ground's paint as the generator lays it (Map-maker II, DESIGN.md §2.5, W2, `groundPaint.ts`):
//
//   1. a terrain built in memory (three families over a ground of the first, a second layer whose shader filter plants a
//      tree wherever the second family stands, a small third layer making the families dirty once more at the end):
//      a painted 4 m cell lands on exactly the poles whose nearest lattice corner it is, a tie going to the corner above;
//      a painted 4 m line whose cells sit on the client's 8 m pattern corners stays two pole rows wide (the snap reads the
//      ground's own corners, so it is never an 8 m staircase); the plants follow the paint with `follow` on and keep their
//      places with it off, the painted families the same either way; a forced alternate's byte picks that alternate by
//      `childIndexOf` and an unforced cell keeps the pole's own choice; colour cells laid bilinearly by the client's own
//      replace-with-amount (written out again here), weighed by their amounts; a file of 8 m cells reads and lays as 8 m
//      cells; the palette entry of another pack and an unknown name lay nothing and are named; on a second terrain whose
//      families are read twice with a family affector over part of the painted line between, the line changes exactly
//      its cells' poles and the second reading plants on exactly those (the paint taken off before each snap, and only
//      where nothing painted over it since); a cell on a 512 m tile's first column reaches a grid ending a pole short;
//   2. the paint's message to another thread and back is the same paint (tiles, palette, follow; a reset);
//   3. on every converted world on disk, thin lines and a speckle of three of its families and a colour: the heights equal
//      the unpainted blocks' by `Object.is`; with `follow` off exactly the cells' poles change, each to its cell's family;
//      with it on every cell's pole holds its family and no pole off the cells takes a painted family; on Yavin 4 (whose
//      plants follow a shader filter) the plants differ with `follow` on and off.
//
// Run: node tools/swg/tests/groundPaint.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GROUND_DRAW_TUNE, worldRowSwitches, type DrawSwitchesKept } from '../../../src/world/groundTiles.ts';
import { assembleTileArrays, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { childChoiceAt, childIndexOf } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { choiceForChild, GroundPaint, paintTileNumber, PAINT_TILE, weightedFamily } from '../../../src/swg/terrain/groundPaint.ts';
import { groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. a terrain built in memory

const header = new W().str('paint').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
  .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const ascn = (family: number) => form('ASCN', form('0001', ihdr(`paint ${family}`), chunk('DATA', new W().i32(family).i32(0).f32(1).bytes())));
const fshd = (family: number) => form('FSHD', form('0000', ihdr(`on ${family}`), chunk('DATA', new W().i32(family).bytes())));
const afsc = (family: number) => form('AFSC', form('0004', ihdr('trees'), chunk('DATA', new W().i32(family).i32(1).i32(0).i32(0).f32(1).bytes())));
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
const sfam = (id: number, name: string, kids: number) => {
  const w = new W().i32(id).str(name).str('').u8(1).u8(2).u8(3).f32(4).f32(1).i32(kids);
  for (let k = 0; k < kids; k++) w.str(`shader/${name}_${k}.sht`).f32(1);
  return chunk('SFAM', w.bytes());
};
const sgrp = form('SGRP', form('0006', sfam(1, 'dirt', 3), sfam(2, 'grass', 3), sfam(3, 'rock', 1)));
const ffam = chunk('FFAM', new W().i32(1).str('tree').u8(0).u8(0).u8(0).f32(1).i32(0).i32(1).str('appearance/tree.apt').f32(1).i32(0).f32(0).f32(0).i32(0).i32(0).f32(1).f32(1).bytes());
const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('noise').bytes()), mfrc(1337, { oct: 2, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008', ffam)), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS',
  layer('ground', rect(-1000, -1000, 1000, 1000), ascn(1)),
  layer('trees on grass', rect(-1000, -1000, 1000, 1000), fshd(2), afsc(1)),
  // A rock patch in the grid's far corner, so the families are dirty once more and snapped again at the end.
  layer('rock', rect(-40, 30, -30, 40), ascn(3)),
)));
const trnBytes = encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));
const template = parseTerrainTemplate(trnBytes);
const group = template.generator.shaderGroup;
ok(template.generator.familyLattice === 8, `the made terrain lays its families on the client's 8 m pattern (${template.generator.familyLattice} m)`);

/** A paint over the made terrain: grass (its pole's own alternate), grass forcing its third alternate, and rock. */
function makePaint(cell = 4): GroundPaint {
  const p = new GroundPaint(cell);
  const missing = p.resolve([{ pack: 'test', name: 'grass' }, { pack: 'test', name: 'grass', child: 2 }, { pack: 'test', name: 'rock' }, { pack: 'other', name: 'grass' }, { pack: 'test', name: 'nothing' }], group, 'test');
  missingSaid = missing;
  return p;
}
let missingSaid: string[] = [];
/** A family cell painted with a palette entry. */
function cellPaint(p: GroundPaint, cx: number, cz: number, entry: number): void {
  const n = p.n;
  const tx = Math.floor(cx / n);
  const tz = Math.floor(cz / n);
  p.familyTile(tx, tz, true)![(cz - tz * n) * n + (cx - tx * n)] = entry;
}
function colourCell(p: GroundPaint, cx: number, cz: number, r: number, g: number, b: number, a: number): void {
  const n = p.n;
  const tx = Math.floor(cx / n);
  const tz = Math.floor(cz / n);
  const t = p.colourTile(tx, tz, true)!;
  const k = ((cz - tz * n) * n + (cx - tx * n)) * 4;
  t[k] = r;
  t[k + 1] = g;
  t[k + 2] = b;
  t[k + 3] = a;
}

const START = -40;
const N = 41;
const STEP = 2;
const at = (x: number, z: number) => ((z - START) / STEP) * N + (x - START) / STEP;
const generate = (p: GroundPaint | null) => {
  const s = new TerrainSampler(template);
  s.paint = p;
  return s.generate(START, START, N, STEP);
};
const plain = generate(null);

{
  const p = makePaint();
  ok(missingSaid.length === 2 && missingSaid.some((m) => m.startsWith('other:grass')) && missingSaid.some((m) => m.startsWith('test:nothing')), `an entry of another pack and a name the world has not got lay nothing and are named (${missingSaid.length})`);
  ok(p.familyOf[1] === 2 && p.familyOf[2] === 2 && p.familyOf[3] === 3 && p.familyOf[4] === 0 && p.familyOf[5] === 0, 'the palette resolves to the world\'s own family ids, nought for what it could not');
  // One 4 m cell: corner (12, -8).
  cellPaint(p, 3, -2, 1);
  const g = generate(p);
  const want = new Set([at(10, -10), at(12, -10), at(10, -8), at(12, -8)]);
  let right = true;
  for (let i = 0; i < N * N; i++) {
    const painted = g.shaders[i] === 2;
    if (painted !== want.has(i)) right = false;
    if (!want.has(i) && g.shaders[i] !== plain.shaders[i]) right = false;
  }
  ok(right, 'one painted 4 m cell lands on exactly the four poles whose nearest corner it is: x 10 and 12, z -10 and -8 (a tie going to the corner above), and nothing else moves');
}

{
  // A 4 m line along a row whose cells sit on the 8 m pattern's corners (z = 16), and one off them (z = 20).
  const p = makePaint();
  for (let cx = -8; cx <= 8; cx++) {
    cellPaint(p, cx, 4, 1);
    cellPaint(p, cx, 5, 3);
  }
  const g = generate(p);
  const rows = new Map<number, number>();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (g.shaders[j * N + i] !== plain.shaders[j * N + i]) rows.set(START + j * STEP, (rows.get(START + j * STEP) ?? 0) + 1);
  const zs = [...rows.keys()].sort((a, b) => a - b);
  ok(zs.join() === '14,16,18,20', `a painted 4 m line reads as a line: the grass row on the 8 m corners moves exactly z 14 and 16 and the rock row z 18 and 20 (moved: ${zs.join(', ')}), never the 8 m staircase z 12 to 18 the snap would spread from a painted corner`);
  let lineRight = true;
  for (let x = -34; x <= 32; x += 2) {
    if (g.shaders[at(x, 14)] !== 2 || g.shaders[at(x, 16)] !== 2 || g.shaders[at(x, 18)] !== 3 || g.shaders[at(x, 20)] !== 3) lineRight = false;
  }
  ok(lineRight, 'and every pole of its cells, x -34 to 32, takes its cell\'s family');
}

{
  // The plants follow the paint (follow on) or keep their places (follow off); the families the same either way.
  const on = makePaint();
  const off = makePaint();
  off.follow = false;
  for (const p of [on, off]) for (let cz = -6; cz <= 2; cz++) for (let cx = -6; cx <= 2; cx++) cellPaint(p, cx, cz, 1);
  const gOn = generate(on);
  const gOff = generate(off);
  let sameFamilies = true;
  for (let i = 0; i < N * N; i++) if (gOn.shaders[i] !== gOff.shaders[i]) sameFamilies = false;
  let treesOn = 0;
  let treesOff = 0;
  let painted = 0;
  for (let i = 0; i < N * N; i++) {
    if (gOn.shaders[i] !== 2) continue;
    painted++;
    if (gOn.floraCollidable[i * 2] === 1) treesOn++;
    if (gOff.floraCollidable[i * 2] === 1) treesOff++;
  }
  let plainTrees = 0;
  for (let i = 0; i < N * N; i++) if (plain.floraCollidable[i * 2]) plainTrees++;
  ok(sameFamilies && painted > 100, `${painted} poles painted grass alike with follow on and off`);
  ok(treesOn === painted && treesOff === 0 && plainTrees === 0, `with follow on the second layer's shader filter reads the paint and plants a tree on every painted pole (${treesOn}); with it off, none (${treesOff}), as the unpainted ground has none (${plainTrees})`);
}

{
  // A forced alternate.
  const p = makePaint();
  for (let cx = -5; cx <= 5; cx++) {
    cellPaint(p, cx, 0, 2);
    cellPaint(p, cx, -4, 1);
  }
  const g = generate(p);
  const grass = group.families.get(2)!;
  let forced = 0;
  let forcedRight = true;
  let own = 0;
  let ownRight = true;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = START + i * STEP;
      const z = START + j * STEP;
      const k = j * N + i;
      if (g.shaders[k] !== 2) continue;
      if (p.entryAtRaw(x, z) === 2) {
        forced++;
        if (childIndexOf(grass, g.children[k]) !== 2 || g.children[k] !== choiceForChild(grass, 2)) forcedRight = false;
      } else if (p.entryAtRaw(x, z) === 1) {
        own++;
        if (g.children[k] !== childChoiceAt(x, z)) ownRight = false;
      }
    }
  }
  ok(forced > 20 && forcedRight, `a cell forcing grass's third alternate stores the byte that picks it by childIndexOf on every pole it takes (${forced} poles)`);
  ok(own > 20 && ownRight, `an unforced cell keeps the pole's own choice, childChoiceAt (${own} poles)`);
  // Weights: an alternate the world row weighs at nought is reached by no byte.
  const weighted = weightedFamily(grass, [1, 0, 1]);
  ok(choiceForChild(weighted, 1) === -1 && childIndexOf(weighted, choiceForChild(weighted, 2)) === 2 && weightedFamily(grass, undefined) === grass, "the world row's weights reweigh the alternates: one weighed nought is reached by no byte, and none named is the family itself");
}

{
  // Colours, bilinear, weighed by their amounts, laid by replace-with-amount.
  const p = makePaint();
  colourCell(p, 0, 0, 200, 100, 50, 255);
  colourCell(p, 1, 0, 10, 20, 30, 128);
  colourCell(p, 0, 1, 90, 180, 250, 64);
  const g = generate(p);
  const f = Math.fround;
  /** The client's replace (computeColor's default branch), written out again. */
  const replace = (old: number, desired: number, a: number) => Math.trunc(f(f(f(a) * desired) + f(f(1 - f(a)) * old)));
  let right = true;
  let reached = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = START + i * STEP;
      const z = START + j * STEP;
      const cells = [
        [0, 0, 200, 100, 50, 255],
        [1, 0, 10, 20, 30, 128],
        [0, 1, 90, 180, 250, 64],
      ];
      let wa = 0;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      for (const [cx, cz, r, gg, b, a] of cells) {
        const w = Math.max(0, 1 - Math.abs(x / 4 - cx)) * Math.max(0, 1 - Math.abs(z / 4 - cz));
        if (w <= 0) continue;
        const aw = a * w;
        wa += aw;
        wr += aw * r;
        wg += aw * gg;
        wb += aw * b;
      }
      const k = (j * N + i) * 3;
      const base = [plain.colors[k], plain.colors[k + 1], plain.colors[k + 2]];
      let want = base;
      if (wa > 0) {
        reached++;
        const amount = wa / 255;
        const col = [Math.round(wr / wa), Math.round(wg / wa), Math.round(wb / wa)];
        want = base.map((o, c) => (amount < 1 ? replace(o, col[c], amount) : col[c]));
      }
      if (g.colors[k] !== want[0] || g.colors[k + 1] !== want[1] || g.colors[k + 2] !== want[2]) right = false;
    }
  }
  ok(right && reached === 21, `every pole within a cell of a painted colour cell takes the four cells round it bilinearly, weighed by their amounts, laid by the client's replace-with-amount over the ground's own colour (${reached} poles)`);
}

{
  // A second terrain, whose families are read twice and painted over between the two readings: dirt over the ground, a
  // layer planting trees on grass, a sand patch (a family affector over part of the painted line, after the first
  // reading), and a second layer planting trees on grass. The snap at the second reading must read the ground's own
  // corners (the paint taken off first, and only where nothing painted over it since), so the paint changes exactly its
  // cells' poles and the second layer plants on exactly those, never on an 8 m staircase round them.
  const sgrp2 = form('SGRP', form('0006', sfam(1, 'dirt', 3), sfam(2, 'grass', 3), sfam(3, 'rock', 1), sfam(4, 'sand', 1)));
  const tgen2 = form('TGEN', form('0000', sgrp2, form('FGRP', form('0008', ffam)), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS',
    layer('ground', rect(-1000, -1000, 1000, 1000), ascn(1)),
    layer('trees on grass', rect(-1000, -1000, 1000, 1000), fshd(2), afsc(1)),
    layer('sand', rect(-20, 0, 0, 30), ascn(4)),
    layer('trees on grass again', rect(-1000, -1000, 1000, 1000), fshd(2), afsc(1)),
  )));
  const t2 = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgen2, form('BAKE')))));
  const g2 = t2.generator.shaderGroup;
  const gen2 = (p: GroundPaint | null) => {
    const s = new TerrainSampler(t2);
    s.paint = p;
    return s.generate(START, START, N, STEP);
  };
  const plain2 = gen2(null);
  const p = new GroundPaint();
  p.resolve([{ pack: 'test', name: 'grass' }], g2, 'test');
  // A 4 m line on the 8 m pattern's corners (z 16), crossing the sand patch.
  for (let cx = -8; cx <= 8; cx++) cellPaint(p, cx, 4, 1);
  const cellOf = (v: number) => Math.floor(v / 4 + 0.5);
  const inLine = (x: number, z: number) => cellOf(z) === 4 && cellOf(x) >= -8 && cellOf(x) <= 8;
  const g = gen2(p);
  let exact = true;
  let line = 0;
  let sandBeside = 0;
  let treesRight = true;
  let trees = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = START + i * STEP;
      const z = START + j * STEP;
      const k = j * N + i;
      const want = inLine(x, z) ? 2 : plain2.shaders[k];
      if (g.shaders[k] !== want) exact = false;
      if (inLine(x, z)) line++;
      else if (plain2.shaders[k] === 4 && (z === 12 || z === 18)) sandBeside++;
      const tree = g.floraCollidable[k * 2] === 1;
      if (tree) trees++;
      if (tree !== inLine(x, z)) treesRight = false;
    }
  }
  ok(exact && line > 50 && sandBeside > 10, `with families read twice and painted over between, a painted 4 m line changes exactly its cells' ${line} poles (z 14 and 16) and nothing else: the ${sandBeside} sand poles beside it in the patch stay sand, and no pole off the line takes grass`);
  ok(treesRight && trees === line, `and the second reading plants on exactly the line's poles (${trees} trees), never on an 8 m staircase round it`);
}

{
  // Paint on a 512 m tile's edge: cells on tile (1, 0)'s first column (x 512) reach the poles of a grid that ends at x 510.
  const p = makePaint();
  for (let cz = 0; cz < 6; cz++) {
    cellPaint(p, 128, cz, 1);
    colourCell(p, 128, cz, 250, 10, 10, 255);
  }
  const s = new TerrainSampler(template);
  s.paint = p;
  const n = 32;
  const g = s.generate(448, 0, n, 2);
  let fam = 0;
  let col = 0;
  for (let z = 0; z < 10; z++) {
    const i = z * n + (n - 1);
    if (g.shaders[i] === 2) fam++;
    if (g.colors[i * 3] !== plain.colors[0] || g.colors[i * 3 + 1] !== plain.colors[1]) col++;
  }
  ok(fam === 10 && col === 10, `a cell on a 512 m tile's first column reaches the last column of a grid ending a pole short of the tile (x 510): ${fam} of 10 poles take its family and ${col} of 10 its colour`);
}

{
  // A file of 8 m cells reads and lays as 8 m cells.
  const p = makePaint(8);
  ok(p.cell === 8 && p.n === PAINT_TILE / 8, 'a paint of 8 m cells keeps its cell: 64 cells a tile a side');
  cellPaint(p, 1, -1, 1);
  const g = generate(p);
  let moved = 0;
  let right = true;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = START + i * STEP;
      const z = START + j * STEP;
      const inside = Math.floor(x / 8 + 0.5) === 1 && Math.floor(z / 8 + 0.5) === -1;
      if (g.shaders[j * N + i] === 2) moved++;
      if ((g.shaders[j * N + i] === 2) !== inside) right = false;
    }
  }
  ok(right && moved === 16, `one 8 m cell takes the sixteen poles nearest its corner (${moved})`);
  ok(new GroundPaint(6).cell === 4, 'a cell the file may not say is read as the 4 m the owner chose');
}

// ---------------------------------------------------------------- 2. the message to another thread

{
  const p = makePaint();
  cellPaint(p, 3, -2, 1);
  cellPaint(p, 200, 300, 3);
  colourCell(p, -600, 4, 1, 2, 3, 4);
  p.follow = false;
  const q = new GroundPaint();
  q.take(p.message(null, null, true));
  const sameTiles = (a: Map<number, Uint8Array>, b: Map<number, Uint8Array>) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k)!.every((x, i) => x === v[i]) && b.get(k) !== v);
  ok(sameTiles(p.fam, q.fam) && sameTiles(p.col, q.col) && q.follow === false && q.familyOf.every((v, i) => v === p.familyOf[i]) && q.choiceOf.every((v, i) => v === p.choiceOf[i]), 'a reset message carries the whole paint, its tiles copied (never shared), its palette and follow');
  const key = paintTileNumber(0, -1);
  p.setFamilyTile(0, -1, null);
  q.take(p.message([key], [], false));
  ok(!q.fam.has(key) && q.fam.size === p.fam.size, 'a tile taken out goes out by name and is taken out on the other side');
  const r = new GroundPaint();
  cellPaint(r, 5, 5, 1);
  r.take(p.message(null, null, true));
  ok(r.fam.size === p.fam.size && !r.fam.has(paintTileNumber(0, 0)) === !p.fam.has(paintTileNumber(0, 0)), 'and a reset lets go of every tile the other side held first');
}

// ---------------------------------------------------------------- 3. every converted world

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the converted half is skipped`);
for (const name of worlds) {
  const w = loadWorld(name);
  if (!w) continue;
  const g = w.template.generator.shaderGroup;
  const fams = [...g.families.values()].filter((f) => f.children.length);
  if (fams.length < 3) continue;
  const blocks = sampleBlocks(w.template, 6, 777);
  // Thin lines through every sampled block, never solid stripes (over a solid patch the end lay paints every pole whatever
  // the snaps did, and nothing would show): a 4 m line of each family, one on the 8 m pattern's corners and two off them,
  // a speckle of the third, and a colour at every fourth cell of the first line.
  const cellsOf = new Map<string, number>();
  const paintOf = (follow: boolean) => {
    const p = new GroundPaint();
    p.resolve(fams.slice(0, 3).map((f) => ({ pack: name, name: f.name })), g, name);
    p.follow = follow;
    for (const b of blocks) {
      const c0x = Math.floor((b.bx * 64 - 8) / 4);
      const c0z = Math.floor((b.bz * 64 - 8) / 4);
      const z8 = c0z + (((-c0z) % 2) + 2) % 2 + 4;
      for (let cx = c0x; cx < c0x + 22; cx++) {
        const put = (cz: number, e: number) => {
          cellPaint(p, cx, cz, e);
          cellsOf.set(`${cx},${cz}`, e);
        };
        put(z8, 1);
        put(z8 + 5, 2);
        if (cx % 3 === 0) put(z8 + 11, 3);
        if ((cx & 3) === 0) colourCell(p, cx, z8, 120, 60, 30, 200);
      }
    }
    return p;
  };
  const plainS = new TerrainSampler(w.template);
  const onS = new TerrainSampler(w.template);
  onS.paint = paintOf(true);
  const offS = new TerrainSampler(w.template);
  offS.paint = paintOf(false);
  const famOf = [0, ...fams.slice(0, 3).map((f) => f.id)];
  const paintFams = new Set(famOf.slice(1));
  let heightsSame = true;
  let floraApart = 0;
  let offExact = true;
  let onCells = true;
  let spread = 0;
  let cellPoles = 0;
  for (const b of blocks) {
    const a = plainS.generateBlock(b.bx, b.bz);
    const on = onS.generateBlock(b.bx, b.bz);
    const off = offS.generateBlock(b.bx, b.bz);
    const s = plainS.blockStart(b.bx, b.bz);
    const np = plainS.numberOfPoles;
    for (let i = 0; i < a.heights.length; i++) if (!Object.is(a.heights[i], on.heights[i])) heightsSame = false;
    for (let j = 0; j < np; j++) {
      for (let i = 0; i < np; i++) {
        const k = j * np + i;
        const e = cellsOf.get(`${Math.floor((s.x + i * plainS.poleStep) / 4 + 0.5)},${Math.floor((s.z + j * plainS.poleStep) / 4 + 0.5)}`) ?? 0;
        // Follow off: the ground's own families with exactly its cells' poles painted over them.
        if (off.shaders[k] !== (e ? famOf[e] : a.shaders[k])) offExact = false;
        // Follow on: every cell's pole holds its family, and no pole off the cells takes a paint family it did not hold.
        if (e) {
          cellPoles++;
          if (on.shaders[k] !== famOf[e]) onCells = false;
        } else if (on.shaders[k] !== a.shaders[k] && paintFams.has(on.shaders[k])) spread++;
        if (on.floraCollidable[k * 2] !== off.floraCollidable[k * 2] || on.floraNonCollidable[k * 2] !== off.floraNonCollidable[k * 2] || on.radialNear[k * 2] !== off.radialNear[k * 2]) floraApart++;
      }
    }
  }
  ok(heightsSame, `${name}: the heights of six blocks painted with lines of three of its families and a colour are the unpainted blocks' by Object.is`);
  ok(offExact && cellPoles > 0, `${name}, follow off: the paint changes exactly its cells' ${cellPoles} poles, each to its cell's family, and every other pole is the unpainted ground's`);
  ok(onCells && spread === 0, `${name}, follow on: every cell's pole holds its cell's family and no pole off the cells takes a painted family (${spread}): a 4 m line stays two pole rows wide through every snap`);
  if (name === 'yavin4') ok(floraApart > 0, `yavin4: its plants follow its shader filters, so with follow on they move with the paint (${floraApart} poles' plants differ from follow off)`);
  else note(`${name}: ${floraApart} poles' plants differ between follow on and off`);
}

// ---------------------------------------------------------------- 4. the world row's switches and weights

{
  // The ground's own switches (`worldRowSwitches`, what the world's arrival, a row landed live and the unload all run):
  // only what a row sets is written, what stood there first kept and put back when the row stops setting it.
  const t = { ...GROUND_DRAW_TUNE, childCorner: [...GROUND_DRAW_TUNE.childCorner], clouds: { ...GROUND_DRAW_TUNE.clouds } };
  const start = JSON.stringify(t);
  const kept: DrawSwitchesKept = {};
  let r = worldRowSwitches(t, { id: 'world' } as never, kept);
  ok(!r.moved && JSON.stringify(t) === start && Object.keys(kept).length === 0, 'a world row that sets no switch writes none and keeps nothing');
  t.colour = 'off';
  r = worldRowSwitches(t, { id: 'world', follow: false } as never, kept);
  ok(!r.moved && t.colour === 'off', "a console switch the row does not name survives the row's arrival");
  const row1 = { id: 'world', masks: false, tint: 'client', clouds: true, alternates: false };
  r = worldRowSwitches(t, row1 as never, kept);
  ok(r.moved && r.children && t.masks === false && t.colour === 'client' && t.clouds.on === true && t.children === false && kept.masks === true && kept.colour === 'off' && kept.children === true, "a row's switches are written, what stood there first kept, the alternates' switch said moved");
  t.masks = true;
  const row2 = { ...row1, follow: false };
  r = worldRowSwitches(t, row2 as never, kept, row1 as never);
  ok(t.masks === true && t.colour === 'client', 'a row written live that does not move a switch leaves it as the console set it since');
  const row3 = { id: 'world', masks: false };
  r = worldRowSwitches(t, row3 as never, kept, row2 as never);
  ok(r.moved && r.children && t.colour === 'off' && t.clouds.on === GROUND_DRAW_TUNE.clouds.on && t.children === true && !('colour' in kept) && !('clouds' in kept) && !('children' in kept) && kept.masks === true, 'a switch the row stops setting is put back as it stood before the row first moved it, and forgotten');
  const gainCap = t.gainCap;
  r = worldRowSwitches(t, { id: 'world', masks: false, gainCap: gainCap + 1 } as never, kept, row3 as never);
  ok(r.moved && t.gainCap === gainCap + 1 && t.masks === true && kept.gainCap === gainCap, "a row's new switch written live is kept as it stood");
  r = worldRowSwitches(t, null, kept);
  ok(r.moved && t.gainCap === gainCap && t.masks === true && t.colour === 'off' && Object.keys(kept).length === 0, 'and the world going puts back every switch its row moved as it stood first, and nothing else');
}

{
  // A world row's weights handed to a pack's own tiler: a family weighed only on its second alternate draws it at every
  // choice, and the weights let go give the family's own alternates back.
  const world = groundWorlds().find((w) => existsSync(join(PACKS, w, 'terrain', 'shaders.json')));
  if (!world) note('no converted world with its ground pictures on disk: the tiler\'s weights are not held');
  else {
    const w = loadWorld(world)!;
    const file = JSON.parse(readFileSync(join(PACKS, world, 'terrain', 'shaders.json'), 'utf8')) as { version?: number; families: ShaderFamilyDef[] };
    const families = file.families.filter((x) => x.children?.length);
    const entries = tileEntries(families, false);
    const arrays = assembleTileArrays(families, entries, entries.map(() => true), 1, { colour: () => [0, 0, 0, 255], normal: () => null, gloss: () => null })!;
    const group = w.template.generator.shaderGroup;
    const planetFamilies = new Map<number, string>([...group.families.values()].map((x) => [x.id, x.name]));
    const { childLayers, priority } = tileLookups(planetFamilies, families, arrays.childLayersByName);
    const tiler = makeTiler(childLayers, priority, group, false);
    const fam = [...group.families.values()].find((f) => f.children.length >= 2 && f.children.every((c) => c.weight > 0) && new Set(childLayers.get(f.id) ?? []).size >= 2);
    if (!fam) note(`${world}: no family with two alternates drawn apart: the tiler's weights are not held`);
    else {
      const list = childLayers.get(fam.id)!;
      const layersOf = () => Array.from({ length: 256 }, (_, b) => tiler.layer(fam.id, b));
      const own = layersOf();
      const wf = weightedFamily(fam, fam.children.map((_, i) => (i === 1 ? 1 : 0)))!;
      tiler.setWeights(new Map([[fam.id, wf]]));
      const weighed = layersOf();
      tiler.setWeights(null);
      const back = layersOf();
      const second = list[1];
      const byRule = weighed.every((l, b) => l === list[childIndexOf(wf, b)]) && own.every((l, b) => l === list[childIndexOf(fam, b)]);
      const ownSecond = own.filter((l) => l === second).length;
      const weighedSecond = weighed.filter((l) => l === second).length;
      ok(byRule && weighedSecond > 250 && ownSecond < 200 && back.join() === own.join(), `${world}: ${fam.name} weighed only on its second alternate draws it (layer ${second}) at ${weighedSecond} of 256 choices where its own weights draw it at ${ownSecond}, every choice as \`childIndexOf\` picks over the weights in force, and the weights let go draw its own again`);
    }
  }
}

console.log(`\ngroundPaint: ${checks} checks passed`);
