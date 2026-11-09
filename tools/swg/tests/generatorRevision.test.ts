// The generator's revision held honest (the horizon pass, DESIGN.md §2.2): a far-ground bake is keyed on
// `GENERATOR_REVISION`, so a change to the ground the generator makes must move that number or every bake on disk would
// quietly stand out of step with the near ground at the hole's edge. Recorded beside the number: a hash of the text of
// every module of the terrain generator the bake's worker imports (line endings folded), and a hash of the generator's
// output over fixed grids of three converted worlds where the packs are. A moved text fails until its hash is recorded
// (and the output checked); a moved output fails until the number moves too.
//
// Run: node tools/swg/tests/generatorRevision.test.ts   (`--print` says the hashes as they stand now)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { loadBakeSampler } from '../horizonWorker.mjs';
import { chunk, encode, form, ihdr, mfrc, W } from './iffWriter.ts';

/**
 * What was recorded for the revision in force: the text, the output over three converted worlds, and the output over a
 * terrain made here in memory, which is checked wherever the packs are not (a launcher's checkout, a machine with none).
 */
// The horizon pass's wave 3b moved the text (trn.ts's `copyInnerHeights` and `layBlockHeights`, which the rings' shape window
// reads a cached block and lays a generated one by; neither is run by the generator) and not the output: the revision stays.
// Its review moved it again (the sampler's cache kept by block number beside its string keys, for the window's probe) and
// not the output.
const RECORDED = { revision: 1, text: '7858343986c45eee', output: 'fa29364a18a48ad2', made: 'f2a2a6ea73e28b08' };

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const root = join(repo, 'src/swg/terrain');

// Every module of the generator the worker reaches, by its relative imports from trn.ts, inside src/swg/terrain.
const seen = new Set<string>();
const visit = (file: string): void => {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
    let p = resolve(dirname(file), m[1]);
    if (!p.endsWith('.ts')) p += '.ts';
    if (p.startsWith(root)) visit(p);
  }
};
visit(join(root, 'trn.ts'));
const h = createHash('sha1');
for (const f of [...seen].sort()) h.update(`${f.slice(root.length).replace(/\\/g, '/')}\n${readFileSync(f, 'utf8').replace(/\r\n/g, '\n')}`);
const text = h.digest('hex').slice(0, 16);

const packs = process.env.SWG3JS_PACKS || join(repo, 'assets-private');
const worlds = ['kashyyyk_main', 'tatooine', 'naboo'].filter((w) => existsSync(join(packs, w, 'terrain.trn')) && existsSync(join(packs, w, 'layout.json')));
const o = createHash('sha1');
for (const w of worlds) {
  const s = loadBakeSampler(join(packs, w));
  for (const [x, z, n, step] of [[-1000, 600, 41, 2], [1200, -800, 41, 2], [-4000, -4000, 33, 16], [2048, 2048, 33, 64]] as const) {
    const g = s.generate(x, z, n, step);
    o.update(Buffer.from(g.heights.buffer, g.heights.byteOffset, g.heights.byteLength));
    o.update(Buffer.from(g.shaders.buffer, g.shaders.byteOffset, g.shaders.byteLength));
    o.update(Buffer.from(g.children.buffer, g.children.byteOffset, g.children.byteLength));
    o.update(Buffer.from(g.colors.buffer, g.colors.byteOffset, g.colors.byteLength));
  }
}
const output = worlds.length === 3 ? o.digest('hex').slice(0, 16) : null;

// A terrain made in memory (the layouts the colour and paint tests build): families of three, two and one alternates, a
// fractal of hills added over a ground, a constant height over part of it, a second family painted in a patch, a colour
// laid and multiplied in rectangles, and a fractal family read: heights, families, choices and colours each moved by it.
const header = new W().str('revision').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
  .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
const sfam = (id: number, name: string, kids: number) => {
  const w = new W().i32(id).str(name).str('').u8(1).u8(2).u8(3).f32(4).f32(1).i32(kids);
  for (let k = 0; k < kids; k++) w.str(`shader/${name}_${k}.sht`).f32(1 + k);
  return chunk('SFAM', w.bytes());
};
const ascn = (family: number) => form('ASCN', form('0001', ihdr(`paint ${family}`), chunk('DATA', new W().i32(family).i32(0).f32(1).bytes())));
const ahcn = (h: number) => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(0).f32(h).bytes())));
const ahfr = form('AHFR', form('0003', ihdr('hills'), form('DATA', chunk('PARM', new W().i32(1).i32(1).f32(50).bytes()))));
const accn = (op: number, r: number, g: number, b: number) => form('ACCN', form('0000', ihdr(`colour ${op}`), chunk('DATA', new W().i32(op).u8(r).u8(g).u8(b).bytes())));
const sgrp = form('SGRP', form('0006', sfam(1, 'dirt', 3), sfam(2, 'grass', 2), sfam(3, 'rock', 1)));
const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('hills').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.004, sy: 0.004 }))));
const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS',
  layer('ground', rect(-1000, -1000, 1000, 1000), ascn(1), ahfr),
  layer('grass', rect(-200, -150, 160, 220), ascn(2)),
  layer('mesa', rect(300, 300, 520, 480), ahcn(40), ascn(3)),
  layer('tint', rect(-400, -400, 0, 0), accn(0, 180, 120, 60)),
  layer('shade', rect(-100, -100, 300, 300), accn(3, 90, 140, 200)),
)));
const made = new TerrainSampler(parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))))));
const mh = createHash('sha1');
let hLo = Infinity;
let hHi = -Infinity;
const madeFams = new Set<number>();
const madeColours = new Set<number>();
for (const [x, z, n, step] of [[-620, -480, 41, 2], [180, 260, 41, 2], [-900, -900, 33, 16], [-512, 256, 33, 64]] as const) {
  const g = made.generate(x, z, n, step);
  for (const v of g.heights) {
    hLo = Math.min(hLo, v);
    hHi = Math.max(hHi, v);
  }
  for (const v of g.shaders) madeFams.add(v);
  for (let k = 0; k + 2 < g.colors.length; k += 3) madeColours.add((g.colors[k] << 16) | (g.colors[k + 1] << 8) | g.colors[k + 2]);
  mh.update(Buffer.from(g.heights.buffer, g.heights.byteOffset, g.heights.byteLength));
  mh.update(Buffer.from(g.shaders.buffer, g.shaders.byteOffset, g.shaders.byteLength));
  mh.update(Buffer.from(g.children.buffer, g.children.byteOffset, g.children.byteLength));
  mh.update(Buffer.from(g.colors.buffer, g.colors.byteOffset, g.colors.byteLength));
}
const madeHash = mh.digest('hex').slice(0, 16);
if (process.argv.includes('--print')) console.log(JSON.stringify({ revision: GENERATOR_REVISION, text, output, made: madeHash, modules: seen.size }));

ok(RECORDED.revision === GENERATOR_REVISION, `GENERATOR_REVISION is ${GENERATOR_REVISION}, the revision recorded here (move both together)`);
ok(text === RECORDED.text, `the generator's text (${seen.size} modules) is the text recorded for revision ${GENERATOR_REVISION}${text === RECORDED.text ? '' : `: it moved (now ${text}). If the ground it makes is the same, record the new hash; if it is not, move GENERATOR_REVISION too, so every bake on disk is refused and made again`}`);
ok(hHi - hLo > 20 && madeFams.size >= 3 && madeColours.size >= 3,`the made terrain's grids carry what the hash is to watch (heights over ${(hHi - hLo).toFixed(0)} m, ${madeFams.size} families, ${madeColours.size} colours)`);
ok(madeHash === RECORDED.made,`the generator's output over a terrain made in memory is the output recorded for revision ${GENERATOR_REVISION}${madeHash === RECORDED.made ? '' : `: it moved (now ${madeHash}): move GENERATOR_REVISION, so every bake on disk is refused and made again, and record the new hashes`}`);
if (output === null) console.log(`note the three worlds' packs are not all here (${worlds.join(', ') || 'none'}): the output over them is not checked (the made terrain's is)`);
else ok(output === RECORDED.output, `the generator's output over fixed grids of three worlds is the output recorded for revision ${GENERATOR_REVISION}${output === RECORDED.output ? '' : `: it moved (now ${output}): move GENERATOR_REVISION, so every bake on disk is refused and made again, and record the new hashes`}`);

console.log(`\ngeneratorRevision: ${checks} checks passed`);
